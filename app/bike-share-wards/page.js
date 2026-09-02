import SiteHeader from '../components/site-header';
import BikeShareWards from '../components/bike-share-wards/BikeShareWards';

export const metadata = {
  title: 'Bike Share by Ward — Stations, Spacing and Ridership',
  description:
    'A profile of Bike Share Toronto in each of the 25 city wards, counted from the City\u2019s trip-level ridership archives: stations and trips by month and year, the classic and e-bike split, how far apart the docks sit, and how sharply the network thins between downtown and the suburbs.',
};

export default function BikeShareWardsPage() {
  return (
    <>
      <SiteHeader current="bike-share-wards" />
      <BikeShareWards />
    </>
  );
}
