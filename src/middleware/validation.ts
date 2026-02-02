import { Request, Response, NextFunction } from "express";
import { z } from "zod";

/**
 * Validation middleware factory that validates request data using Zod schemas
 * @param schema - Zod schema to validate against
 * @param source - Where to get the data from: 'body', 'params', or 'query'
 */
export function validate(schema: z.ZodTypeAny, source: "body" | "params" | "query" = "body") {
    return (req: Request, res: Response, next: NextFunction) => {
        const data = source === "body" ? req.body : source === "params" ? req.params : req.query;

        const result = schema.safeParse(data);

        if (!result.success) {
            const errorMessages = result.error.issues.map((issue) => issue.message).join(", ");
            return res.status(400).json({
                error: `Validation error: ${errorMessages}`,
            });
        }

        // Replace the original data with validated and sanitized data
        if (source === "body") {
            req.body = result.data;
        } else if (source === "params") {
            req.params = result.data as Request["params"];
        } else {
            req.query = result.data as Request["query"];
        }

        next();
    };
}

/**
 * Helper to validate integer ID parameters
 */
export function validateIdParam(req: Request, res: Response, next: NextFunction) {
    const id = req.params.id;
    if (!id || !/^\d+$/.test(id)) {
        return res.status(400).json({
            error: "Validation error: id must be a valid integer",
        });
    }
    next();
}
