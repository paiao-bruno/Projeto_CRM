import { registerDecorator, ValidationArguments, ValidationOptions } from "class-validator";
import { containsSqlInjectionPattern } from "../utils/sql-injection.util";

export function IsSafeString(validationOptions?: ValidationOptions) {
  return function decorate(object: object, propertyName: string) {
    registerDecorator({
      name: "isSafeString",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === "string" ? !containsSqlInjectionPattern(value) : true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} contém conteúdo inválido.`;
        },
      },
    });
  };
}
