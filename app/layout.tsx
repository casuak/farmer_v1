import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "松溪农场 · Pinebrook",
  description: "种植、逛小镇、穿过森林，乘一叶小船去看海。固定 45° 视角的春日体素生活。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-CN"><body className="antialiased">{children}</body></html>;
}
