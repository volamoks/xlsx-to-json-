export interface ConversionResult<T> {
  data: T[];
  errors: string[];
  warnings: string[];
  statistics: {
    totalRecords: number;
    successfulConversions: number;
    failedConversions: number;
    skippedRecords: number;
    duplicatesFound: number;
    processingTime: number;
  };
}

export interface IConverter<TInput, TOutput> {
  convert(input: TInput[]): Promise<ConversionResult<TOutput>>;
  validate(input: TInput[]): Promise<string[]>;
  configureMapping(mapping: Record<string, string>): void;
  getConverterName(): string;
}

export interface ConversionOptions {
  skipDuplicates?: boolean;
  mergeStrategy?: 'replace' | 'merge' | 'skip';
  validationLevel?: 'strict' | 'lenient';
  defaultValues?: Record<string, string | number | boolean>;
}

export interface MappingRule {
  sourceField: string;
  targetField: string;
  transformer?: (value: string | number | boolean | undefined) => string | number | boolean | undefined;
  required?: boolean;
  defaultValue?: string | number | boolean;
}

export interface ConversionStrategy<TInput, TOutput> {
  convert(data: TInput[], options?: ConversionOptions): Promise<ConversionResult<TOutput>>;
  validate(data: TInput[]): Promise<string[]>;
  getMappingRules(): MappingRule[];
  setMappingRules(rules: MappingRule[]): void;
}
