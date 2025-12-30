import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    reporter: "html",
    // Run tests serially to avoid port conflicts (each test starts its own server)
    workers: 1,
    use: {
        baseURL: "http://localhost:3099",
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
