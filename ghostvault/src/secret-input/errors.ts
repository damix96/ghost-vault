const errors: Record<string, { status: number; message: string }> = {
  INVALID_INPUT: { status: 400, message: 'Input is invalid. Check names and complete every value.' },
  INPUT_FORBIDDEN: { status: 403, message: 'Open the local input page again to authorize this form.' },
  REQUEST_NOT_FOUND: { status: 404, message: 'Input request is unavailable. It may belong to an earlier runtime.' },
  REQUEST_CONFLICT: { status: 409, message: 'Request parameters or submitted names do not match.' },
  REQUEST_CLOSED: { status: 409, message: 'This input request is already closed.' },
  COMMIT_IN_PROGRESS: { status: 409, message: 'Saving is in progress. Check the request status.' },
  NAME_CONFLICT: { status: 409, message: 'A name is unavailable. Refresh the variables and start a new request.' },
  REVISION_CONFLICT: { status: 409, message: 'A variable changed while the form was open. Start a new request.' },
  REQUEST_EXPIRED: { status: 410, message: 'Input request expired. Start a new request.' },
  INPUT_BUSY: { status: 429, message: 'Too many input requests. Complete or cancel existing requests.' },
  PROVIDER_UNAVAILABLE: { status: 503, message: 'System secret protection is unavailable. Nothing was saved.' },
  SECRET_DECRYPTION_FAILED: { status: 422, message: 'Existing protected data could not be decrypted. Nothing was saved.' },
  STORE_FAILED: { status: 503, message: 'Secret storage failed. Check the local Vault before retrying.' },
  INPUT_STOPPING: { status: 503, message: 'Vault is stopping. Start a request after it restarts.' },
};

export class SecretInputError extends Error {
  public status: number;
  constructor(public code: string) {
    const definition = errors[code] ?? errors.STORE_FAILED;
    super(definition.message);
    this.code = errors[code] ? code : 'STORE_FAILED';
    this.status = definition.status;
  }

  public static safe = (error: unknown): SecretInputError => {
    if (error instanceof SecretInputError) return error;
    const aliases: Record<string, string> = { INVALID_SECRET_INPUT: 'INVALID_INPUT', SECRET_WRITE_CONFLICT: 'REVISION_CONFLICT', ALIAS_CONFLICT: 'NAME_CONFLICT', SECRET_STORAGE_UNAVAILABLE: 'PROVIDER_UNAVAILABLE' };
    const code = String((error as { code?: unknown } | null)?.code ?? 'STORE_FAILED');
    return new SecretInputError(aliases[code] ?? code);
  };
  public public = (): { code: string; message: string } => ({ code: this.code, message: this.message });
}
