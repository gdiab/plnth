import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Plnth",
  description: "Personal HTML artifact host",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
