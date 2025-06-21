import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function PollPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: poll, error } = await supabase
    .from("polls")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !poll) {
    notFound();
  }

  const createdDate = new Date(poll.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold mb-4 text-center">{poll.title}</h1>
        
        <div className="text-center text-gray-600 dark:text-gray-300 mb-6">
          <p className="text-sm">Created on</p>
          <p className="font-medium">{createdDate}</p>
        </div>

        <div className="text-center">
          <Link
            href="/"
            className="inline-block rounded-full border border-solid border-gray-300 dark:border-gray-600 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 px-6 py-2 text-sm font-medium"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}