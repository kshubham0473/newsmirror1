import type { Metadata } from "next";
import MirrorClient from "@/components/mirror/MirrorClient";

export const metadata: Metadata = {
  title: "Your mirror — NewsMirror",
  description: "What your reading looked like this week.",
};

export default function MirrorPage() {
  return <MirrorClient />;
}
