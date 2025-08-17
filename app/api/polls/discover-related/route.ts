import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const { pollIds } = await request.json();

    if (!pollIds || !Array.isArray(pollIds) || pollIds.length === 0) {
      return NextResponse.json(
        { error: "Invalid input: pollIds array is required" },
        { status: 400 }
      );
    }

    // Validate that all pollIds are valid UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidIds = pollIds.filter(id => !uuidRegex.test(id));
    
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: "Invalid UUID format in pollIds", invalidIds },
        { status: 400 }
      );
    }

    // Limit the number of input poll IDs to prevent abuse
    if (pollIds.length > 100) {
      return NextResponse.json(
        { error: "Too many poll IDs provided (max 100)" },
        { status: 400 }
      );
    }

    // Call the recursive function to get all related poll IDs
    const { data, error } = await supabase.rpc('get_all_related_poll_ids', {
      input_poll_ids: pollIds
    });

    if (error) {
      console.error('Error discovering related polls:', error);
      return NextResponse.json(
        { error: "Failed to discover related polls" },
        { status: 500 }
      );
    }

    // Extract poll IDs from the response
    const allRelatedIds = data ? data.map((row: { poll_id: string }) => row.poll_id) : [];

    return NextResponse.json({
      allRelatedIds,
      originalCount: pollIds.length,
      discoveredCount: allRelatedIds.length
    });

  } catch (error) {
    console.error('Error in discover-related API:', error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Add GET method for testing
export async function GET() {
  return NextResponse.json({
    message: "Poll discovery API endpoint",
    usage: "POST /api/polls/discover-related with { pollIds: string[] }",
    description: "Recursively discovers all follow-up polls for given poll IDs"
  });
}