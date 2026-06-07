// ============================================================
// App.jsx — integration changes for Node Registry
// Apply these changes to portal/src/App.jsx
// ============================================================

// 1. ADD IMPORT near top of App.jsx:
import NodeRegistry from "./components/NodeRegistry";

// 2. ADD STATE inside your App component (alongside existing state):
const [selectedNodes, setSelectedNodes] = useState([]);

// 3. ADD "Nodes" to your tab list.
// Find where you render your existing tabs (e.g. "Dashboard", "Launch Study", "My Studies")
// and add a Nodes tab. Example:

const TABS = ["Dashboard", "Nodes", "Launch Study", "My Studies"];  // add "Nodes"

// 4. RENDER NodeRegistry in your tab switch.
// Find your tab content renderer and add this case:

{activeTab === "Nodes" && (
  <NodeRegistry
    session={session}          // your Supabase session object
    selectedNodes={selectedNodes}
    onSelectionChange={setSelectedNodes}
  />
)}

// 5. PASS selectedNodes to your Launch Study tab so researchers can see
//    which nodes they've picked:

{activeTab === "Launch Study" && (
  <LaunchStudy
    session={session}
    preselectedNodes={selectedNodes}   // add this prop
    // ...your other props
  />
)}

// 6. In your LaunchStudy component, use preselectedNodes to pre-fill
//    the nodes field instead of hardcoding "NHS Moorfields + Edinburgh".

// ── EXAMPLE: updated node selector in LaunchStudy ────────────────────────────
// Replace your hardcoded node list with a fetch from /nodes/list:

// const [availableNodes, setAvailableNodes] = useState([]);
// useEffect(() => {
//   fetch(`${ORCHESTRATOR}/nodes/list`, {
//     headers: { Authorization: `Bearer ${session.access_token}` }
//   })
//   .then(r => r.json())
//   .then(data => setAvailableNodes(data.filter(n => n.connectivity === "online")));
// }, [session]);
//
// Then render checkboxes/pills from availableNodes instead of hardcoded ones.
