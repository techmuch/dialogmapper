import React, { useState } from 'react';

interface UiFeature {
  id: string;
  category: 'toolbar' | 'sidebar' | 'nodecard' | 'canvas' | 'hotkeys';
  name: string;
  shortcut?: string;
  badge?: string;
  description: string;
  howToUse: string;
  whyItMatters: string;
}

const uiFeatures: UiFeature[] = [
  // --- Toolbar Features ---
  {
    id: 'map-switcher',
    category: 'toolbar',
    name: 'Map Switcher Dropdown',
    description: 'Switch between dialog maps or create a new map.',
    howToUse: 'Click the dropdown at the top left to switch maps. Select "+ New map…" to name and create a new map.',
    whyItMatters: 'Allows organizing complex wicked problems into dedicated sub-maps while sharing nodes between them.'
  },
  {
    id: 'preset-filters',
    category: 'toolbar',
    name: 'Preset Filter Pills (Everything, Open Questions)',
    badge: 'Filter',
    description: 'Separates the discussions the group has settled from the ones still live.',
    howToUse: 'Click "Open questions" to fade out every question the group has already decided, along with its answers and their arguments. A question counts as decided when one of the Ideas answering it is marked resolved. Click "Everything" to reset.',
    whyItMatters: 'Marking an Idea resolved is how a decision gets recorded, so this asks the map what is left to talk about. Only top-level questions are tested — a settled sub-question inside a live debate stays visible, because the reasoning that got the group here is part of the discussion.'
  },
  {
    id: 'status-filters',
    category: 'toolbar',
    name: 'Status Chips (open, resolved, rejected, parked)',
    badge: 'Filter',
    description: 'Fade nodes by their status.',
    howToUse: 'Click any chip in the toolbar centre to drop nodes with that status out of view. They combine with everything else: each control narrows the map further.',
    whyItMatters: 'Every filter criterion narrows and none widens. An earlier version expanded each match by one hop of neighbours, which pulled back in whatever had just been filtered out, so filtering by anything showed almost everything.'
  },
  {
    id: 'map-search',
    category: 'toolbar',
    name: 'Map Search Bar',
    shortcut: 'Real-time',
    description: 'Filter nodes on the current map by keyword, matching title, body or tags.',
    howToUse: 'Type into the "Filter on this map…" input. The canvas instantly dims everything that does not contain the text.',
    whyItMatters: 'It lights the nodes containing the text and nothing else — not their children, not their parents. Searching for a word should find the nodes with that word in them, not a subtree that happens to hang off one.'
  },
  {
    id: 'undo-redo',
    category: 'toolbar',
    name: 'Undo & Redo Buttons (↶ ↷)',
    shortcut: '⌘Z / ⌘⇧Z',
    description: 'Multi-level action history with descriptive action tooltips.',
    howToUse: 'Click ↶ (Undo) or ↷ (Redo) or press ⌘Z / ⌘⇧Z. Hover over the button to see the exact action title being undone.',
    whyItMatters: 'Provides total safety when making rapid structural edits during live conversation.'
  },
  {
    id: 'layout-mode',
    category: 'toolbar',
    name: 'Layout Mode Toggle (Auto layout / Freeform)',
    badge: 'Default: Auto',
    description: 'Auto layout keeps the argument tree tidy as you type. Freeform is your own arrangement.',
    howToUse: 'Auto layout is on by default and re-runs on every change, so the map is always what holding down `l` would give you. Drag any node to take over — you do not need to find this toggle first.',
    whyItMatters: 'Auto layout is a view, not a stored arrangement: it never writes positions, so a hand-arranged map comes back untouched when you switch it off. Dragging saves the visible positions before handing over, so nothing except the node under your cursor moves.'
  },
  {
    id: 'tidy-button',
    category: 'toolbar',
    name: 'Tidy Button',
    shortcut: 'l',
    description: 'Lays out the tree and saves the result.',
    howToUse: 'Click "Tidy" or press `l`. In freeform this is the explicit "commit this arrangement" action.',
    whyItMatters: 'It saves as it goes, so the map ends up indistinguishable from one where every node was dragged into place — and it survives a reload.'
  },
  {
    id: 'zoom-picker',
    category: 'toolbar',
    name: 'Zoom Level Picker (bottom-left)',
    badge: 'Default: Auto',
    description: 'Pins how big everything looks, or leaves it to the tool.',
    howToUse: 'Auto lets tidying frame the whole map, which is the long-standing behaviour. Pick a percentage and that level survives `l`, `f`, Space and auto layout — they reposition the viewport without changing the zoom. Zooming by hand updates the picker to the nearest preset.',
    whyItMatters: 'At a fixed zoom the tool cannot frame everything, so those commands centre on your selection instead, or on the middle of the map when nothing is selected.'
  },
  {
    id: 'insert-button',
    category: 'toolbar',
    name: 'Insert Node Palette Button',
    shortcut: '/',
    description: 'Opens global search palette to search every map and transclude an existing node.',
    howToUse: 'Click "Insert…" or press `/`. Type to search across all maps, then select a node to insert onto the current map.',
    whyItMatters: 'Enables seamless transclusion (reuse) of existing Ideas and Questions across multiple decision maps.'
  },
  {
    id: 'minimap-toggle',
    category: 'toolbar',
    name: 'Minimap Toggle',
    description: 'Shows or hides the bottom-corner canvas radar view.',
    howToUse: 'Click "Minimap on / off" to toggle the canvas navigator thumbnail.',
    whyItMatters: 'Helps navigate large map canvases spanning beyond screen boundaries.'
  },
  {
    id: 'details-toggle',
    category: 'toolbar',
    name: 'Details Sidebar Button',
    shortcut: 'Tab',
    description: 'Opens or closes the right-side node details panel.',
    howToUse: 'Click "Details" or press `Tab` to toggle the sidebar without losing focus on your selected node.',
    whyItMatters: 'Keeps the canvas clean while providing access to deep markdown text, images, and metadata.'
  },

  // --- Sidebar Features ---
  {
    id: 'sidebar-type-status',
    category: 'sidebar',
    name: 'Type & Status Selectors',
    description: 'Change a node’s IBIS type or lifecycle status.',
    howToUse: 'Click a Type chip (Question, Idea, Pro, Con, Note) or Status chip (Open, Resolved, Parked, Rejected). Changing type relabels the node\'s edges to match — an Idea that "responds to" a Question becomes a Question that "questions" it. Types with no legal relationship to a neighbour are greyed out with the reason.',
    whyItMatters: 'A relationship is a reading of the types at each end of the arrow, so changing one end has to relabel it. Showing impossible types as unavailable is better than offering them and refusing afterwards — and one ⌘Z reverses both the type and the relabelled links.'
  },
  {
    id: 'sidebar-markdown',
    category: 'sidebar',
    name: 'Markdown Body Editor',
    description: 'Full markdown editor for detailed evidence, research, or caveats.',
    howToUse: 'Click into the "Body (Markdown)" textarea to type detailed notes. Edits save automatically on blur.',
    whyItMatters: 'Keeps node titles short for canvas legibility while storing comprehensive context.'
  },
  {
    id: 'sidebar-tags',
    category: 'sidebar',
    name: 'Tag Manager (#tags)',
    description: 'Add, remove, or filter nodes by hashtag labels.',
    howToUse: 'Type a tag name and press `Enter` to add. Click `#tag` to filter the map, or click `×` to remove.',
    whyItMatters: 'Categorizes nodes across topics and enables instant cross-cutting search.'
  },
  {
    id: 'sidebar-attachments',
    category: 'sidebar',
    name: 'Asset Dropzone & File Attachments',
    description: 'Attach images, PDFs, or documents to any node.',
    howToUse: 'Drag & drop files directly onto the dropzone or click to upload. Files save safely into `.assets/`.',
    whyItMatters: 'Stores primary source evidence alongside decision arguments.'
  },
  {
    id: 'sidebar-relationships',
    category: 'sidebar',
    name: 'Relationship Inspector',
    description: 'Lists all incoming and outgoing connections as readable sentences.',
    howToUse: 'Click any linked node title in the Relationships section to jump focus directly to that node on the canvas.',
    whyItMatters: 'Provides instant graph traversal and auditability.'
  },
  {
    id: 'sidebar-multi',
    category: 'sidebar',
    name: 'Multi-Select Panel (Bulk Tags & Status)',
    badge: 'Bulk',
    description: 'With several nodes selected, the panel switches to what applies to a set.',
    howToUse: 'Select two or more nodes. The panel shows a breakdown of the selection, then three-state chips for tags and status: solid means every selected node has that value, faded with a count (1/3) means only some do. Click either one to apply it to all; click a solid tag to remove it from all.',
    whyItMatters: 'Faded is an affordance, not a dead end — it tells you the selection is inconsistent and lets you fix it in the same click. The whole edit is a single undo entry, so tagging forty nodes takes one ⌘Z to reverse, and undo restores each node\'s own prior tags rather than a shared state.'
  },
  {
    id: 'sidebar-deletion',
    category: 'sidebar',
    name: 'Remove from Map vs. Delete Everywhere',
    badge: 'Danger',
    description: 'Soft unlinking vs permanent database deletion.',
    howToUse: 'Click "Remove from this map" to un-link without touching other maps. Click "Delete everywhere" to permanently erase.',
    whyItMatters: 'Protects transcluded nodes from accidental destruction across other maps.'
  },

  // --- Node Card Controls ---
  {
    id: 'card-handles',
    category: 'nodecard',
    name: 'Edge Drag Handles (Top & Bottom Ports)',
    description: 'Connect nodes together on the canvas by dragging.',
    howToUse: 'Drag a line from a node handle to another node. Backend rules enforce whether the link is legal.',
    whyItMatters: 'Source sits on Top, Target on Bottom because IBIS edges point child-to-parent (e.g. Pro → Idea).'
  },
  {
    id: 'card-editing',
    category: 'nodecard',
    name: 'Inline Title Editor',
    shortcut: 'Enter',
    description: 'Edit node titles directly on the canvas card.',
    howToUse: 'Double-click a node title or select and press `Enter`. Type the new title and press `Enter` again to commit.',
    whyItMatters: 'Committing keeps the node selected so you can instantly press `+` or `i` for the next thought.'
  },
  {
    id: 'card-badges',
    category: 'nodecard',
    name: 'Card Status Badges (✓ ◷ ✳n ▤)',
    description: 'Visual markers for resolved, parked, shared, or attached content.',
    howToUse: 'Look at the top-right badges on any card: `✓` (Resolved), `◷` (Parked), `✳n` (Shared), `▤` (Attachments).',
    whyItMatters: 'Conveys node status and transclusion count at a glance.'
  },
  {
    id: 'multi-select',
    category: 'canvas',
    name: 'Multi-Select (Shift-Drag & Shift-Click)',
    shortcut: 'a',
    description: 'Select several nodes at once, for grouping or bulk actions.',
    howToUse: 'Shift-drag a box across the canvas, or shift-click nodes one at a time to extend the selection. Press `a` to select everything currently visible, which respects any active filter.',
    whyItMatters: 'A plain drag pans the canvas, so the map keeps feeling like a map; selection is the deliberate, modified gesture.'
  },
  {
    id: 'groups',
    category: 'canvas',
    name: 'Groups',
    shortcut: 'g',
    badge: 'Cluster',
    description: 'A set of nodes that move together as one.',
    howToUse: 'Select two or more nodes and press `g`, or click the "Group N nodes" button that appears. Drag anywhere on the outline to move every member with it. Click the name to rename, ◎ to reselect its members, and × to ungroup.',
    whyItMatters: 'The outline has no geometry of its own — it is derived from where the members are, so moving one member restretches it and the two can never drift apart. There is nothing to resize, because membership is the bounds.'
  },
  {
    id: 'group-safety',
    category: 'canvas',
    name: 'Ungrouping & Group Membership',
    description: 'Groups are an arrangement of nodes, never a container that owns them.',
    howToUse: 'Click × on a group to dissolve it — every node stays exactly where it sits. A node belongs to one group per map, so regrouping it moves it rather than leaving it in two.',
    whyItMatters: 'Grouping creates no IBIS edges and carries no grammar weight, so clustering by theme or owner never pollutes the argument tree that exports depend on.'
  },
  {
    id: 'canvas-navigation',
    category: 'canvas',
    name: 'Canvas Navigation (Arrows, Space, f)',
    shortcut: '← ↑ → ↓',
    description: 'Move the selection and the viewport without the mouse.',
    howToUse: 'Arrow keys move the selection to the nearest node in that direction. `Space` centres on the selection, or fits the whole map when nothing is selected. `f` always fits the map.',
    whyItMatters: 'Arrow navigation is spatial rather than structural: it moves to what you can see, which is what a person means by "the node to the right".'
  },
  {
    id: 'phone-qr',
    category: 'canvas',
    name: 'Join From a Phone (QR Code)',
    shortcut: '?',
    description: 'A scannable code for getting a phone onto the map.',
    howToUse: 'Press `?` for the help panel; the QR sits at the top. Or scan the one printed in your terminal when the server starts.',
    whyItMatters: 'The code carries the machine\'s LAN address, never localhost, plus a per-run access key — so scanning just works and the map is not left open to the network unprotected.'
  }
];

export const MainUiGuide: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<'all' | 'toolbar' | 'sidebar' | 'nodecard'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredFeatures = uiFeatures.filter(f => {
    // The "Canvas & Node Cards" tab covers both card controls and canvas-wide
    // gestures like selection and grouping, which is how a user thinks of them.
    const matchesCategory =
      activeCategory === 'all' ||
      f.category === activeCategory ||
      (activeCategory === 'nodecard' && f.category === 'canvas');
    const matchesSearch = f.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          f.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          f.howToUse.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <section id="ui-guide" style={{ padding: '5rem 0', background: 'var(--bg-dark)' }}>
      <div className="container">
        
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <span style={{ color: 'var(--accent-cyan)', fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Interactive UI Reference
          </span>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginTop: '0.5rem', marginBottom: '0.75rem' }}>
            Main UI Buttons & Feature Walkthrough
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '750px', margin: '0 auto' }}>
            A complete guide explaining every button, toolbar control, sidebar field, and canvas interaction in the dialogmapper interface.
          </p>
        </div>

        {/* Filter Controls & Search */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '2rem'
        }}>
          <div className="tabs-nav" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
            <button
              onClick={() => setActiveCategory('all')}
              className={`tab-btn ${activeCategory === 'all' ? 'active' : ''}`}
            >
              All Controls ({uiFeatures.length})
            </button>
            <button
              onClick={() => setActiveCategory('toolbar')}
              className={`tab-btn ${activeCategory === 'toolbar' ? 'active' : ''}`}
            >
              Toolbar Header
            </button>
            <button
              onClick={() => setActiveCategory('sidebar')}
              className={`tab-btn ${activeCategory === 'sidebar' ? 'active' : ''}`}
            >
              Details Sidebar
            </button>
            <button
              onClick={() => setActiveCategory('nodecard')}
              className={`tab-btn ${activeCategory === 'nodecard' ? 'active' : ''}`}
            >
              Canvas & Node Cards
            </button>
          </div>

          <input
            type="text"
            placeholder="Search button or feature..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              background: '#060911',
              border: '1px solid var(--border-color)',
              borderRadius: '0.5rem',
              padding: '0.5rem 1rem',
              color: '#fff',
              fontSize: '0.875rem',
              outline: 'none',
              minWidth: '260px'
            }}
          />
        </div>

        {/* Feature Cards Grid */}
        <div className="grid-2">
          {filteredFeatures.map(feature => (
            <div key={feature.id} className="card" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>
                  {feature.name}
                </h3>
                {feature.shortcut && (
                  <kbd className="kbd" style={{ marginLeft: '0.5rem' }}>
                    {feature.shortcut}
                  </kbd>
                )}
              </div>

              <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', marginBottom: '1rem', lineHeight: 1.6 }}>
                {feature.description}
              </p>

              <div style={{ background: '#070b14', padding: '0.875rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)', marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-cyan)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                  How to Use:
                </div>
                <div style={{ fontSize: '0.875rem', color: '#e2e8f0', lineHeight: 1.5 }}>
                  {feature.howToUse}
                </div>
              </div>

              <div style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--text-muted)' }}>Why it matters:</strong> {feature.whyItMatters}
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
};
