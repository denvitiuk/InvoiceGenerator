import dynamic from 'next/dynamic';

// Render only on the client to avoid SSR touching localStorage (zustand persist, etc.)
const ClientApp = dynamic(() => import('../src/ClientApp'), {
  ssr: false,
  loading: () => null,
});

export default function Home() {
  return <ClientApp />;
}
