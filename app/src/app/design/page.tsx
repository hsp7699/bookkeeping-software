import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

// The component gallery is a development tool; it doesn't exist in production.
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
