import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { InteractiveSandbox } from './components/InteractiveSandbox';
import { FeatureWalkthroughs } from './components/FeatureWalkthroughs';
import { InstallationGuide } from './components/InstallationGuide';
import { CliCheatsheet } from './components/CliCheatsheet';
import { ArchitectureSection } from './components/ArchitectureSection';
import { Footer } from './components/Footer';

export function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />
      <main style={{ flex: 1 }}>
        <Hero />
        <InteractiveSandbox />
        <FeatureWalkthroughs />
        <InstallationGuide />
        <CliCheatsheet />
        <ArchitectureSection />
      </main>
      <Footer />
    </div>
  );
}

export default App;
