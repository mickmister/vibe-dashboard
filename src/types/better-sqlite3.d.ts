declare module 'better-sqlite3' {
  namespace Database {
    interface Statement {
      reader: boolean;
      all(parameters?: unknown): unknown[];
      run(parameters?: unknown): { changes: number | bigint; lastInsertRowid: number | bigint };
      iterate(parameters?: unknown): IterableIterator<unknown>;
    }

    interface Database {
      prepare(sql: string): Statement;
      pragma(source: string): unknown;
      close(): void;
    }
  }

  interface DatabaseConstructor {
    new(path: string): Database.Database;
    (path: string): Database.Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
