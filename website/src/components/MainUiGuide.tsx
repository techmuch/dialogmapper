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
    name: 'Preset Filter Pills (Everything, Open Questions, Unresolved, Shared)',
    badge: 'Filter',
    description: 'Instant structural filters to isolate specific node categories on the canvas.',
    howToUse: 'Click "Open questions" to hide answered topics, "Unresolved" to focus on active debate, or "Shared" to highlight transcluded nodes (✳n). Click "Everything" to reset.',
    whyItMatters: 'Reduces visual noise on large maps without deleting or hiding underlying graph nodes permanently.'
  },
  {
    id: 'type-toggles',
    category: 'toolbar',
    name: 'Node Type Toggle Buttons (?, i, +, -, n)',
    badge: 'Filter',
    description: 'Quickly toggle visibility for Questions, Ideas, Pros, Cons, or Notes.',
    howToUse: 'Click any type icon in the toolbar center to toggle its canvas visibility on/off.',
    whyItMatters: 'Enables focusing exclusively on argument structures (e.g. Ideas + Pros/Cons) or notes during facilitation.'
  },
  {
    id: 'map-search',
    category: 'toolbar',
    name: 'Map Search Bar',
    shortcut: 'Real-time',
    description: 'Filter nodes on the current map by keyword matching title or content.',
    howToUse: 'Type into the "Filter on this map…" input. The canvas instantly dims non-matching nodes.',
    whyItMatters: 'Finds key discussion points quickly across large maps containing dozens of nodes.'
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
    description: 'Switch between deterministic tree auto-layout and manual node dragging.',
    howToUse: 'Click "Auto layout" to let dialogmapper align nodes automatically into argument trees, or switch to "Freeform" to arrange nodes manually.',
    whyItMatters: 'Prevents chaotic node overlap during fast capture while allowing manual customization when needed.'
  },
  {
    id: 'tidy-button',
    category: 'toolbar',
    name: 'Tidy Button',
    shortcut: 'l',
    description: 'Instantly re-aligns all nodes into a clean IBIS tree.',
    howToUse: 'Click "Tidy" or press `l` on your keyboard to trigger auto-layout at any time.',
    whyItMatters: 'Cleans up scattered nodes in one frame.'
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
    howToUse: 'Click a Type chip (Question, Idea, Pro, Con, Note) or Status chip (Open, Resolved, Parked, Rejected).',
    whyItMatters: 'Server validates edge rules when re-typing, preventing illegal connections.'
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
    id: 'group-boxes',
    category: 'nodecard',
    name: 'Spatial Group Boxes',
    badge: 'Cluster',
    description: 'Resizable visual containers drawn around clusters of nodes.',
    howToUse: 'Double-click the group title (e.g. "Cluster") to edit its label. Drag handles on edges to resize width and height. Click × to delete the group box container.',
    whyItMatters: 'Carries zero IBIS grammar weight and creates no graph edges. Teams can organize clusters by topic or owner without polluting the decision tree.'
  }
];

export const MainUiGuide: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<'all' | 'toolbar' | 'sidebar' | 'nodecard'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredFeatures = uiFeatures.filter(f => {
    const matchesCategory = activeCategory === 'all' || f.category === activeCategory;
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
