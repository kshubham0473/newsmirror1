import { redirect } from "next/navigation";

/**
 * /story/[id] has moved to /timeline/[id] (Build 5).
 * This permanent redirect ensures all existing links and bookmarks keep working.
 */
export default function StoryPage({ params }: { params: { id: string } }) {
  redirect(`/timeline/${params.id}`);
}
