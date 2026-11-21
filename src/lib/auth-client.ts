import { deviceAuthorizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
    plugins: [deviceAuthorizationClient()],
    fetchOptions: {
        onError(context) {
            console.error("Better Auth Error:", context.error);
        },
    },
    // Disable automatic refetching of session, to prevent unnecessary network requests
    sessionOptions: {
        refetchOnWindowFocus: false,
    },
});
