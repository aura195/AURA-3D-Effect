export const metadata = {
  title: 'Dissolve-Effect',
  description: 'Emissive dissolve effect in Three.js',
};

import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="loading">{children}</body>
    </html>
  );
}


