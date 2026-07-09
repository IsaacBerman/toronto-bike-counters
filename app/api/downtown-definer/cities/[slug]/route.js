import { NextResponse } from 'next/server';
import { getCityBySlug } from '../../../../lib/downtown-definer/db';

export async function GET(request, { params }) {
  const { slug } = await params;
  const city = await getCityBySlug(slug);

  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  return NextResponse.json({ city });
}
