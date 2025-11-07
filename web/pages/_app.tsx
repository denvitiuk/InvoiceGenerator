// web/pages/_app.tsx
import type { AppProps } from 'next/app';
import '../src/app.css'; // твой глобальный CSS из Vite

export default function MyApp({ Component, pageProps }: AppProps) {
    return <Component {...pageProps} />;
}