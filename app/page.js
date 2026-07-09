import Link from 'next/link';

export const metadata = {
  title: 'Observing the City',
  description: 'Data and community tools exploring how cities move and how people see them',
};

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-16">
      <div className="container mx-auto px-4 max-w-4xl text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-3 tracking-tight">
          Observing the City
        </h1>
        <p className="text-lg text-gray-600 mb-12 max-w-2xl mx-auto leading-relaxed">
          Data and community tools exploring how cities move and how people see them.
        </p>

        <div className="grid sm:grid-cols-2 gap-6">
          <Link
            href="/bike-counters"
            className="block bg-white p-8 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl hover:-translate-y-0.5 transition"
          >
            <h2 className="text-xl font-bold text-gray-900 mb-2">Toronto Bicycle Counters</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              Explore bicycle traffic data from permanent counting stations across Toronto.
            </p>
          </Link>

          <Link
            href="/downtown-definer"
            className="block bg-white p-8 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl hover:-translate-y-0.5 transition"
          >
            <h2 className="text-xl font-bold text-gray-900 mb-2">DowntownDefiner</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              Draw the boundary of what you consider &ldquo;downtown&rdquo; and see how it compares to everyone else&apos;s.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
