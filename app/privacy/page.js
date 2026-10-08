import SiteHeader from '../components/site-header';

export const metadata = {
  title: 'Privacy Policy | Observing the City',
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
        <div className="container mx-auto px-4 max-w-3xl pt-4 pb-12 sm:pb-16">
          <p className="dd-kicker mb-3">Legal</p>
          <h1 className="dd-title text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
            Privacy Policy
          </h1>
          <p className="text-xs mb-6" style={{ color: 'var(--ink-3)' }}>
            Last updated: July 2026
          </p>

          <div className="dd-panel-ruled p-6 sm:p-8 space-y-6">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              This is what{' '}
              <b style={{ color: 'var(--ink)' }}>observingthecity.ca</b> collects when you visit
              and what happens to it. There are no accounts, and I never ask for your name or
              email.
            </p>

            <Section title="What gets collected">
              <p>
                The site collects basic usage data when you visit: which pages you view, roughly where you&rsquo;re visiting from, what browser
                and device you&rsquo;re on, and what page sent you here. That happens through the
                analytics and advertising services described below, which also set cookies of their
                own.
              </p>
              <p>
                The &ldquo;Where is Downtown?&rdquo; tool stores the area you draw so it can be
                added to the heatmap. Your drawing is saved against a one-way, salted hash of
                a randomly generated browser identifier, so you can come back and update your
                submission, and a separate salted hash of your IP address, which is used to limit
                spam. Your raw IP address is never stored, and nothing about
                a submission is tied to who you are.
              </p>
            </Section>

            <Section title="Advertising (Google AdSense)">
              <p>
                The site uses <b style={{ color: 'var(--ink)' }}>Google AdSense</b> to show ads.
                Third-party vendors, including Google, use cookies to serve ads based on your prior
                visits to this and other websites. You can turn off personalized ads in{' '}
                <a
                  href="https://www.google.com/settings/ads"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-link-accent"
                >
                  Google Ads Settings
                </a>
                , and opt out of many other vendors&rsquo; advertising cookies at{' '}
                <a
                  href="https://www.aboutads.info/choices/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-link-accent"
                >
                  aboutads.info/choices
                </a>{' '}
                or{' '}
                <a
                  href="https://www.youronlinechoices.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-link-accent"
                >
                  youronlinechoices.com
                </a>
                . For how Google uses data from sites like this one, see{' '}
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
                I use Vercel Analytics to see aggregate traffic, like which pages get visited and
                roughly where visitors come from. I use it to see which tools people use.
              </p>
            </Section>

            <Section title="Sharing">
              <p>
                I don&rsquo;t sell your personal information. The data described above passes
                through the third-party services the site runs on, mainly Google for advertising and
                Vercel for hosting and analytics, each with its own privacy policy. Anonymous,
                aggregated data, like the downtown heatmap, is shown publicly on the site.
              </p>
            </Section>

            <Section title="Your choices">
              <p>
                You can block or delete cookies in your browser settings, and use the opt-out links
                above for personalized ads. With cookies blocked, the downtown tool won&rsquo;t remember that
                you&rsquo;ve already submitted.
              </p>
            </Section>

            <Section title="Changes">
              <p>
                If this policy changes, I&rsquo;ll update the date at the top.
              </p>
            </Section>

            <Section title="Contact">
              <p>
                Email questions to{' '}
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
