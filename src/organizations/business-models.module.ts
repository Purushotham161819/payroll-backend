import { DynamicModule, Module } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Schema } from 'mongoose';
import { tenantContext } from './tenant-context';

export function businessModel(
  connection: Connection,
  name: string,
  schema: Schema,
  organizationId?: string,
): Model<any> {
  if (organizationId && !/^ORG\d{6,}$/.test(organizationId))
    throw new Error('Invalid organization context');
  const key = organizationId ? `${organizationId}_${name}` : name;
  if (connection.models[key]) return connection.models[key];
  const legacy = connection.models[name] ?? connection.model<any>(name, schema);
  return organizationId
    ? (connection.model<any>(
        key,
        schema,
        `${organizationId.toLowerCase()}_${legacy.collection.collectionName}`,
      ) as unknown as Model<any>)
    : legacy;
}

@Module({})
export class BusinessModelsModule {
  static forFeature(
    definitions: { name: string; schema: Schema }[],
  ): DynamicModule {
    const providers = definitions.map(({ name, schema }) => ({
      provide: getModelToken(name),
      inject: [getConnectionToken()],
      useFactory: (connection: Connection) => {
        const resolve = () =>
          businessModel(
            connection,
            name,
            schema,
            tenantContext.getStore()?.organizationId,
          );
        const legacy = businessModel(connection, name, schema);
        return new Proxy(legacy, {
          construct: (_target, args) => Reflect.construct(resolve(), args),
          get: (_target, property) => {
            const model = resolve();
            if (property === 'db' && tenantContext.getStore()?.organizationId) {
              const prefix = tenantContext
                .getStore()!
                .organizationId!.toLowerCase();
              return new Proxy(connection, {
                get: (db, prop) => {
                  if (prop === 'collection')
                    return (collection: string) =>
                      db.collection(`${prefix}_${collection}`);
                  const value = Reflect.get(db, prop);
                  return typeof value === 'function' ? value.bind(db) : value;
                },
              });
            }
            const value = Reflect.get(model, property);
            return typeof value === 'function' ? value.bind(model) : value;
          },
        });
      },
    }));
    return {
      module: BusinessModelsModule,
      providers,
      exports: providers.map((p) => p.provide),
    };
  }
}
