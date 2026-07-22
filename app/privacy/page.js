import SiteHeader from '../components/site-header';

export const metadata = {
  title: 'Privacy Policy — Observing the City',
  description:
    'How Observing the City handles data, cookies, advertising and analytics.',
};

function Section({ title, children }) {
  return (
    <div>
      <h2 className="dd-title text-xl mb-2" style={{ color: 'var(--ink)' }}>
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
        {children}
      </div>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
        <div className="container mx-auto px-4 max-w-3xl py-12 sm:py-16">
          <p className="dd-kicker mb-3">Legal</p>
          <h1 className="dd-title text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
            Privacy Policy
          </h1>
          <p className="text-xs mb-6" style={{ color: 'var(--ink-3)' }}>
            Last updated: July 2026
          </p>

          <div className="dd-panel-ruled p-6 sm:p-8 space-y-6">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              This Privacy Policy explains what information Observing the City
              (&ldquo;we,&rdquo; &ldquo;us&rdquo;) collects when you visit{' '}
              <b style={{ color: 'var(--ink)' }}>observingthecity.ca</b> and how it is used. By using
              the site, you agree to the practices described here.
            </p>

            <Section title="Information we collect">
              <p>
                We do not require you to create an account, and we do not ask for your name, email
                address or other directly identifying information to use the tools on this site. We
                collect:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  <b style={{ color: 'var(--ink)' }}>Usage and device data</b>, collected
                  automatically when you visit — such as pages viewed, approximate location, browser
                  and device type, and referring pages — through our analytics and advertising
                  providers described below.
                </li>
                <li>
                  <b style={{ color: 'var(--ink)' }}>Cookies and similar technologies</b>, set by us
                  and by third parties (see &ldquo;Advertising&rdquo; and &ldquo;Analytics&rdquo;).
                </li>
                <li>
                  <b style={{ color: 'var(--ink)' }}>Content you submit</b> — in the
                  &ldquo;Where is Downtown?&rdquo; tool, the map area you draw is stored so it can be
                  combined into an anonymous heatmap. It is saved with a one-way, salted hash of a
                  randomly generated browser identifier (used only to let you update your own
                  submission) and a separate salted hash of your IP address (used only to limit
                  spam/abuse). We do not store your raw IP address, and these submissions are not
                  linked to your identity.
                </li>
              </ul>
            </Section>

            <Section title="Advertising (Google AdSense)">
              <p>
                We use <b style={{ color: 'var(--ink)' }}>Google AdSense</b> to show ads. Third-party
                vendors, including Google, use cookies to serve ads based on your prior visits to
                this and other websites.
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  Google&rsquo;s use of advertising cookies enables it and its partners to serve ads
                  to you based on your visits to this site and/or other sites on the internet.
                </li>
                <li>
                  You can opt out of personalized advertising by visiting{' '}
                  <a
                    href="https://www.google.com/settings/ads"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dd-link-accent"
                  >
                    Google Ads Settings
                  </a>
                  .
                </li>
                <li>
                  You can opt out of some third-party vendors&rsquo; use of cookies for personalized
                  advertising at{' '}
                  <a
                    href="https://www.aboutads.info/choices/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dd-link-accent"
                  >
                    aboutads.info/choices
                  </a>{' '}
                  and{' '}
                  <a
                    href="https://www.youronlinechoices.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dd-link-accent"
                  >
                    youronlinechoices.com
                  </a>
                  .
                </li>
              </ul>
              <p>
                For more information on how Google uses data from sites that use its services, see{' '}
                <a
                  href="https://policies.google.com/technologies/partner-sites"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-link-accent"
                >
                  Google&rsquo;s Privacy &amp; Terms
                </a>
                .
              </p>
            </Section>

            <Section title="Analytics">
              <p>
                We use privacy-friendly analytics (Vercel Analytics) to understand aggregate traffic
                — for example, which pages are visited and roughly where visitors come from. This is
                used only in aggregate to improve the site.
              </p>
            </Section>

            <Section title="How we use information">
              <p>
                We use the information above to operate and improve the site, understand which tools
                are useful, prevent abuse, and display advertising that helps keep the site free.
              </p>
            </Section>

            <Section title="Sharing of information">
              <p>
                We do not sell your personal information. Information is processed by the third-party
                service providers that make the site work — principally Google (advertising) and
                Vercel (hosting and analytics) — each under their own privacy policies. Anonymous,
                aggregated data (such as the &ldquo;downtown&rdquo; heatmap) may be shown publicly on
                the site.
              </p>
            </Section>

            <Section title="Your choices">
              <p>
                You can control or delete cookies through your browser settings and opt out of
                personalized advertising using the links above. Blocking cookies may affect how some
                parts of the site work.
              </p>
            </Section>

            <Section title="Changes to this policy">
              <p>
                We may update this policy from time to time. Material changes will be reflected by
                the &ldquo;Last updated&rdquo; date above.
              </p>
            </Section>

            <Section title="Contact">
              <p>
                Questions about this policy? Email{' '}
                <a href="mailto:observingthecity@gmail.com" className="dd-link-accent">
                  observingthecity@gmail.com
                </a>
                .
              </p>
            </Section>
          </div>
        </div>
      </div>
    </>
  );
}
