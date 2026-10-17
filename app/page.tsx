import MediaTracker from "@/app/components/media-tracker";

export const dynamic = "force-dynamic";

// The Worker authorizes every dynamic page and API request before rendering.
export default function Home() {
  return <MediaTracker firstName={null} />;
}
