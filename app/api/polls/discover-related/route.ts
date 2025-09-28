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

    // Log the input for debugging
    console.log('Poll discovery API called with poll IDs:', pollIds);

    // Try the RPC function first, fall back to manual discovery if it fails
    let allRelatedIds: string[] = [];
    
    try {
      const { data, error } = await supabase.rpc('get_all_related_poll_ids', {
        input_poll_ids: pollIds
      });

      if (error) {
        console.warn('RPC function failed, falling back to manual discovery:', error);
        throw new Error('RPC failed');
      }

      // Extract poll IDs from the RPC response
      allRelatedIds = data ? data.map((row: { poll_id: string }) => row.poll_id) : [];
      console.log('RPC discovery successful:', { input: pollIds.length, found: allRelatedIds.length });
    } catch (rpcError) {
      console.log('Using manual poll discovery fallback');
      
      // Manual discovery - find all related polls by traversing both directions
      const discoveredIds = new Set<string>(pollIds);
      let changed = true;
      let iterations = 0;
      const maxIterations = 10; // Prevent infinite loops
      
      while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;
        
        const currentIds = Array.from(discoveredIds);
        
        // Find polls that follow up to any of our current polls (descendants)
        const { data: descendants } = await supabase
          .from('polls')
          .select('id')
          .in('follow_up_to', currentIds);
        
        if (descendants) {
          for (const poll of descendants) {
            if (!discoveredIds.has(poll.id)) {
              discoveredIds.add(poll.id);
              changed = true;
            }
          }
        }
        
        // Find polls that our current polls follow up to (ancestors)
        const { data: currentPolls } = await supabase
          .from('polls')
          .select('id, follow_up_to')
          .in('id', currentIds)
          .not('follow_up_to', 'is', null);
        
        if (currentPolls) {
          for (const poll of currentPolls) {
            if (poll.follow_up_to && !discoveredIds.has(poll.follow_up_to)) {
              discoveredIds.add(poll.follow_up_to);
              changed = true;
            }
          }
        }
      }
      
      allRelatedIds = Array.from(discoveredIds);
      console.log('Manual discovery complete:', { 
        input: pollIds.length, 
        found: allRelatedIds.length, 
        iterations 
      });
    }

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