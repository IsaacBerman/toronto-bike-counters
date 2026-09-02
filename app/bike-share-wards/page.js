import { redirect } from 'next/navigation';

// The ward profile used to live here before it became a tab on the counters
// page. The old links are still out in the world, so this keeps them working
// and carries ?ward= across to its new home rather than dropping people on a
// generic page.
export const metadata = {
  title: 'Bike Share by Ward',
  // Nothing here to index -- the content moved, and the sitemap points at
  // /bike-counters instead.
  robots: { index: false, follow: true },
};

export default async function BikeShareWardsRedirect({ searchParams }) {
  const params = await searchParams;
  const query = new URLSearchParams({
    counter: 'Bike Share Toronto',
    tab: 'wards',
  });
  // Only a real ward number travels; anything else lands on the whole city
  // rather than being handed on for the tab to reject.
  const ward = Number(Array.isArray(params?.ward) ? params.ward[0] : params?.ward);
  if (Number.isInteger(ward) && ward >= 1 && ward <= 25) query.set('ward', String(ward));
  redirect(`/bike-counters?${query.toString()}`);
}
