/**
 * Base class for all application errors.
 * Provides consistent error structure and message handling.
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Error thrown when a requested resource is not found.
 */
export class NotFoundError extends AppError {
    constructor(resource: string, identifier?: string | number) {
        const message = identifier
            ? `${resource} ${identifier} not found`
            : `${resource} not found`;
        super(message, 404);
    }
}

/**
 * Error thrown when input validation fails.
 */
export class ValidationError extends AppError {
    constructor(message: string) {
        super(message, 400);
    }
}

/**
 * Error thrown when required configuration is missing.
 */
export class ConfigurationError extends AppError {
    constructor(message: string) {
        super(message, 503);
    }
}

/**
 * Error thrown when an LLM API call fails.
 */
export class LLMError extends AppError {
    public readonly provider: string;

    constructor(provider: string, message: string) {
        super(`[${provider}] ${message}`, 502);
        this.provider = provider;
    }
}

/**
 * Error thrown when database operations fail.
 */
export class DatabaseError extends AppError {
    constructor(message: string) {
        super(message, 500);
    }
}

/**
 * Error thrown when a test run fails.
 */
export class TestRunError extends AppError {
    constructor(message: string) {
        super(message, 500);
    }
}

/**
 * Safely extracts an error message from an unknown error type.
 * Use this instead of `(error as Error).message`.
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    return "An unknown error occurred";
}

/**
 * Determines the appropriate HTTP status code for an error.
 */
export function getErrorStatusCode(error: unknown): number {
    if (error instanceof AppError) {
        return error.statusCode;
    }
    return 500;
}

/**
 * Type guard to check if an error is an AppError.
 */
export function isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
}

