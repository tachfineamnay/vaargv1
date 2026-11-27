import type { ReactElement } from 'react';
import { EmptyState } from '../components/EmptyState';

export default function NotFound(): ReactElement {
  return <EmptyState kind="notFound" actionHref="/" />;
}
