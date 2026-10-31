import { FastifyInstance, FastifyRequest } from 'fastify';

export class RequestCapture {
  public readonly enabled = false;
  constructor(_directory?: string) {}

  public install = (_app: FastifyInstance): void => {};

  public send = async (_request: FastifyRequest, _id: string, _target: string, operation: () => Promise<Response>): Promise<Response> => operation();
}
