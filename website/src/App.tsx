import { Layout, Page } from "./components/Layout";
import { Router, useRoute, Link } from "./router";
import { Home } from "./pages/Home";
import { Walkthrough } from "./pages/Walkthrough";
import { Start } from "./pages/Start";
import { HowToIndex, HowToPage } from "./pages/HowTo";
import { Ibis } from "./pages/Ibis";
import { Reference } from "./pages/Reference";

function NotFound() {
  return (
    <Page
      title="That page does not exist"
      lede="It may have moved, or the link may be from an older version of this site."
    >
      <div className="narrow btn-row">
        <Link to="/" className="btn btn--primary">
          Home
        </Link>
        <Link to="/how-to" className="btn">
          How-to guides
        </Link>
        <Link to="/reference" className="btn">
          Reference
        </Link>
      </div>
    </Page>
  );
}

function Routes() {
  const { path } = useRoute();

  if (path === "/") return <Home />;
  if (path === "/walkthrough") return <Walkthrough />;
  if (path === "/start") return <Start />;
  if (path === "/how-to") return <HowToIndex />;
  if (path.startsWith("/how-to/")) return <HowToPage />;
  if (path === "/ibis") return <Ibis />;
  if (path === "/reference") return <Reference />;
  return <NotFound />;
}

export function App() {
  return (
    <Router>
      <Layout>
        <Routes />
      </Layout>
    </Router>
  );
}

export default App;
