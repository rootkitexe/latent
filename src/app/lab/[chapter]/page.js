import { CHAPTERS } from '@/chapters/registry';
import LabClient from './LabClient';

// Pre-render one sandbox per chapter so the site can be exported as static files.
export const dynamicParams = false;
export function generateStaticParams() {
  return CHAPTERS.map((c) => ({ chapter: c.id }));
}

export default function Lab({ params }) {
  return <LabClient chapter={params.chapter} />;
}
