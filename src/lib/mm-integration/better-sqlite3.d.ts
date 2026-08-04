declare module 'better-sqlite3' {
  export interface Statement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  }

  export default class Database {
    constructor(path: string);
    pragma(source: string): unknown;
    exec(source: string): this;
    prepare(source: string): Statement;
    close(): void;
  }
}
