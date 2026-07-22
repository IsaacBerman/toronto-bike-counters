import SiteHeader from '../components/site-header';

export const metadata = {
  title: 'Contact — Observing the City',
  description: 'Get in touch with Observing the City — feedback, data corrections and ideas welcome.',
};

export default function ContactPage() {
  return (
    <>
      <SiteHeader />
      <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
        <div className="container mx-auto px-4 max-w-3xl py-12 sm:py-16">
          <p className="dd-kicker mb-3">Contact</p>
          <h1 className="dd-title text-4xl sm:text-5xl mb-6" style={{ color: 'var(--ink)' }}>
            Get in touch
          </h1>

          <div className="dd-panel-ruled p-6 sm:p-8 space-y-5" style={{ color: 'var(--ink-2)' }}>
            <p className="text-base leading-relaxed">
              Observing the City is an independent project, and feedback genuinely helps. Get in
              touch about any of the following:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed">
              <li>Questions about a tool or the underlying data</li>
              <li>Corrections or issues with the data or a chart</li>
              <li>Ideas for new datasets, features or city tools</li>
              <li>Anything else about the site</li>
            </ul>

            <div className="pt-2">
              <p className="dd-kicker mb-1" style={{ color: 'var(--ink-3)' }}>
                Email
              </p>
              <a
                href="mailto:observingthecity@gmail.com"
                className="dd-title text-xl"
                style={{ color: 'var(--accent)' }}
              >
                observingthecity@gmail.com
              </a>
            </div>

            <div className="pt-2">
              <a
                href="https://buymeacoffee.com/observingthecity"
                target="_blank"
                rel="noopener noreferrer"
                className="dd-btn dd-btn-accent"
              >
                Support the project
              </a>
              <p className="text-xs mt-2" style={{ color: 'var(--ink-3)' }}>
                The site is free and ad-supported; contributions help cover data and hosting costs.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
