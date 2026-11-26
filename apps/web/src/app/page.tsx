import { CollectionGrid } from '../components/CollectionGrid';
import { SITE_CONFIG } from '../lib/site';

export default function HomePage(): React.ReactElement {
  return (
    <>
      <section className="hero" data-testid="hero">
        <p className="eyebrow">Industrial adaptive commerce</p>
        <h1>{SITE_CONFIG.name}</h1>
        <p>{SITE_CONFIG.tagline}</p>
      </section>
      <CollectionGrid />
    </>
  );
}
