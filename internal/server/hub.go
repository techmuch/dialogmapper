package server

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Event is one state change pushed to every connected client. The frontend
// applies these optimistically, so the payload is always the full object
// rather than a delta — reconstructing a node from a partial patch on the
// client is a reliable source of divergence bugs.
type Event struct {
	Type    string `json:"type"`
	MapID   string `json:"mapId,omitempty"`
	Payload any    `json:"payload,omitempty"`
	// Origin is the client id that caused the change, so a sender can skip
	// re-applying its own optimistic update.
	Origin string `json:"origin,omitempty"`
}

type client struct {
	id   string
	conn *websocket.Conn
	send chan []byte
	hub  *Hub
	once sync.Once
}

// Hub fans events out to every open WebSocket.
type Hub struct {
	mu      sync.RWMutex
	clients map[*client]bool

	register   chan *client
	unregister chan *client
	events     chan []byte
	done       chan struct{}
	closeOnce  sync.Once
}

func newHub() *Hub {
	return &Hub{
		clients:    map[*client]bool{},
		register:   make(chan *client),
		unregister: make(chan *client),
		events:     make(chan []byte, 256),
		done:       make(chan struct{}),
	}
}

func (h *Hub) run() {
	for {
		select {
		case <-h.done:
			return
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = true
			n := len(h.clients)
			h.mu.Unlock()
			log.Printf("dialogmapper: client connected (%d open)", n)
		case c := <-h.unregister:
			h.mu.Lock()
			if h.clients[c] {
				delete(h.clients, c)
				close(c.send)
			}
			h.mu.Unlock()
		case msg := <-h.events:
			h.mu.RLock()
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					// A client that cannot keep up is dropped rather than
					// allowed to block every other client's updates. It will
					// reconnect and refetch.
					go c.close()
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) broadcast(e Event) {
	b, err := json.Marshal(e)
	if err != nil {
		log.Printf("dialogmapper: cannot encode %s event: %v", e.Type, err)
		return
	}
	select {
	case h.events <- b:
	default:
		log.Printf("dialogmapper: event buffer full, dropping %s", e.Type)
	}
}

func (h *Hub) closeAll() {
	h.mu.RLock()
	cs := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		cs = append(cs, c)
	}
	h.mu.RUnlock()
	for _, c := range cs {
		c.close()
	}
	h.closeOnce.Do(func() { close(h.done) })
}

func (c *client) close() {
	c.once.Do(func() {
		_ = c.conn.Close()
		c.hub.unregister <- c
	})
}

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	// The cross-origin check in ServeHTTP already ran; repeating the logic
	// here keeps the guarantee if the handler is ever mounted directly.
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return origin == "" || isLocalOrigin(origin, r.Host)
	},
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already wrote a response.
	}
	c := &client{
		id:   r.URL.Query().Get("clientId"),
		conn: conn,
		send: make(chan []byte, 64),
		hub:  s.hub,
	}
	s.hub.register <- c

	go c.writeLoop()
	go c.readLoop()

	// Tell the new client which map to show first so it can render without a
	// second round trip.
	if m, err := s.st.DefaultMap(); err == nil {
		s.hub.broadcast(Event{Type: "hello", MapID: m.ID})
	}
}

// readLoop keeps the connection alive and drains client frames. The client
// does not drive state over the socket — all writes go through the REST API,
// which keeps validation in exactly one place — so incoming frames are only
// pings and presence.
func (c *client) readLoop() {
	defer c.close()
	c.conn.SetReadLimit(1 << 20)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (c *client) writeLoop() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
