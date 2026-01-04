import { SDKGridClient } from '../../grid/sdkClient';

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const gridClient = SDKGridClient.getInstance();
        
        const response = await gridClient.createAccount(body);

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        // Format the error response consistently
        const errorResponse = {
            error: error.message || "An unknown error occurred",
            details: error.data?.details || [{ code: "UNKNOWN_ERROR" }],
            status: error.status || 500
        };

        return new Response(
            JSON.stringify(errorResponse),
            {
                status: errorResponse.status,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}