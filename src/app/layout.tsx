import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "portfolio — gestão de ciclo de vida de produtos",
  description:
    "Acompanhamento de portfólio de produtos: ciclo de vida, financeiro, execução e saúde.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
