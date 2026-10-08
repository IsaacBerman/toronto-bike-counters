import SiteHeader from '../components/site-header';

export const metadata = {
  title: 'Contact | Observing the City',
  description: 'Email Observing the City with feedback, data corrections or ideas.',
};

export default function ContactPage() {
  return (
    <>
      <SiteHeader />
      <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
        <div className="container mx-auto px-4 max-w-3xl pt-4 pb-12 sm:pb-16">
          <p className="dd-kicker mb-3">Contact</p>
          <h1 className="dd-title text-4xl sm:text-5xl mb-6" style={{ color: 'var(--ink)' }}>
            Get in touch
          </h1>

          <div className="dd-panel-ruled p-6 sm:p-8 space-y-5" style={{ color: 'var(--ink-2)' }}>
            <p className="text-base leading-relaxed">
              This is a one-person project, and email is the best way to reach me.
            </p>

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
                The site is free and I pay for the hosting myself. If you use it, donations help
                cover that.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
