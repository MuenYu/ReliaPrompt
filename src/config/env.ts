import { z } from "zod";
import { ConfigurationError } from "../errors";

const envSchema = z
    .object({
        NODE_ENV: z.enum(["dev", "prod", "test"], {
            message: "NODE_ENV environment variable is required",
        }),
    })
    .passthrough(); // Allow other environment variables
export interface ValidatedEnv {
    PORT: number;
    SCHEMA_PATH: string;
    DATABASE_PATH: string;
    MIGRATIONS_PATH: string;
}

let validatedEnv: ValidatedEnv | null = null;

/**
 * Validates and returns environment variables
 * @throws {ConfigurationError} if validation fails
 */
export function validateEnv(): ValidatedEnv {
    if (validatedEnv) {
        return validatedEnv;
    }

    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        const errorMessages = result.error.issues.map((issue) => issue.message).join(", ");
        throw new ConfigurationError(`Environment variable validation failed: ${errorMessages}`);
    }

    const portValue = result.data.PORT;
    const parsedPort =
        typeof portValue === "string"
            ? Number(portValue)
            : typeof portValue === "number"
              ? portValue
              : Number.NaN;
    const resolvedEnv: ValidatedEnv = {
        PORT: Number.isFinite(parsedPort) ? parsedPort : 3000,
        SCHEMA_PATH: `./src/db/schema.ts`,
        DATABASE_PATH: `./data/${result.data.NODE_ENV}.db`,
        MIGRATIONS_PATH: `./drizzle`,
    };
    validatedEnv = resolvedEnv;

    return resolvedEnv;
}

/**
 * Gets validated environment variables (must call validateEnv first)
 */
export function getEnv(): ValidatedEnv {
    if (!validatedEnv) {
        throw new ConfigurationError(
            "Environment variables not validated. Call validateEnv() first."
        );
    }
    return validatedEnv;
}
