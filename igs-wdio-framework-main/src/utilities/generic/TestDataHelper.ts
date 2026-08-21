/**
 * Test Data Helper
 * Comprehensive utility for managing test data from CSV and JSON files
 */

import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

interface TestDataRecord {
    [key: string]: any;
}

interface TestDataConfig {
    dataDirectory?: string;
    encoding?: BufferEncoding;
    csvDelimiter?: string;
    csvHeaders?: boolean;
}

export class TestDataHelper {
    private static instance: TestDataHelper;
    private config: TestDataConfig;
    private dataCache: Map<string, TestDataRecord[]> = new Map();

    private constructor(config: TestDataConfig = {}) {
        this.config = {
            dataDirectory: path.join(process.cwd(), 'test', 'data'),
            encoding: 'utf8',
            csvDelimiter: ',',
            csvHeaders: true,
            ...config
        };
    }

    /**
     * Get singleton instance of TestDataHelper
     */
    public static getInstance(config?: TestDataConfig): TestDataHelper {
        if (!TestDataHelper.instance) {
            TestDataHelper.instance = new TestDataHelper(config);
        }
        return TestDataHelper.instance;
    }

    /**
     * Load JSON test data
     * @param fileName - Name of the JSON file (with or without .json extension)
     * @param useCache - Whether to use cached data (default: true)
     * @returns Array of test data records
     */
    public loadJsonData(fileName: string, useCache: boolean = true): TestDataRecord[] {
        const normalizedFileName = this.normalizeFileName(fileName, '.json');

        if (useCache && this.dataCache.has(normalizedFileName)) {
            console.log(`📁 Loading cached JSON data from: ${normalizedFileName}`);
            return this.dataCache.get(normalizedFileName)!;
        }

        try {
            const filePath = path.join(this.config.dataDirectory!, normalizedFileName);
            console.log(`📂 Loading JSON data from: ${filePath}`);

            if (!fs.existsSync(filePath)) {
                throw new Error(`JSON file not found: ${filePath}`);
            }

            const fileContent = fs.readFileSync(filePath, this.config.encoding!);
            const jsonData = JSON.parse(fileContent);

            // Ensure data is always an array
            const dataArray = Array.isArray(jsonData) ? jsonData : [jsonData];

            if (useCache) {
                this.dataCache.set(normalizedFileName, dataArray);
            }

            console.log(`✅ Successfully loaded ${dataArray.length} records from JSON`);
            return dataArray;
        } catch (error) {
            console.error(`❌ Error loading JSON data from ${fileName}:`, error);
            throw error;
        }
    }

    /**
     * Load CSV test data
     * @param fileName - Name of the CSV file (with or without .csv extension)
     * @param useCache - Whether to use cached data (default: true)
     * @returns Array of test data records
     */
    public loadCsvData(fileName: string, useCache: boolean = true): TestDataRecord[] {
        const normalizedFileName = this.normalizeFileName(fileName, '.csv');

        if (useCache && this.dataCache.has(normalizedFileName)) {
            console.log(`📁 Loading cached CSV data from: ${normalizedFileName}`);
            return this.dataCache.get(normalizedFileName)!;
        }

        try {
            const filePath = path.join(this.config.dataDirectory!, normalizedFileName);
            console.log(`📂 Loading CSV data from: ${filePath}`);

            if (!fs.existsSync(filePath)) {
                throw new Error(`CSV file not found: ${filePath}`);
            }

            const fileContent = fs.readFileSync(filePath, this.config.encoding!);
            const csvData = parse(fileContent, {
                columns: this.config.csvHeaders,
                delimiter: this.config.csvDelimiter,
                skip_empty_lines: true,
                trim: true
            });

            if (useCache) {
                this.dataCache.set(normalizedFileName, csvData);
            }

            console.log(`✅ Successfully loaded ${csvData.length} records from CSV`);
            return csvData;
        } catch (error) {
            console.error(`❌ Error loading CSV data from ${fileName}:`, error);
            throw error;
        }
    }

    /**
     * Get specific record by index
     * @param fileName - Data file name
     * @param index - Record index
     * @param fileType - File type ('json' or 'csv')
     */
    public getRecordByIndex(fileName: string, index: number, fileType: 'json' | 'csv' = 'json'): TestDataRecord {
        const data = fileType === 'json' ? this.loadJsonData(fileName) : this.loadCsvData(fileName);

        if (index < 0 || index >= data.length) {
            throw new Error(`Index ${index} is out of bounds. Data has ${data.length} records.`);
        }

        console.log(`📋 Retrieved record at index ${index} from ${fileName}`);
        return data[index];
    }

    /**
     * Get record by field value
     * @param fileName - Data file name
     * @param fieldName - Field to search by
     * @param fieldValue - Value to search for
     * @param fileType - File type ('json' or 'csv')
     */
    public getRecordByField(fileName: string, fieldName: string, fieldValue: any, fileType: 'json' | 'csv' = 'json'): TestDataRecord | undefined {
        const data = fileType === 'json' ? this.loadJsonData(fileName) : this.loadCsvData(fileName);

        const record = data.find(record => record[fieldName] === fieldValue);

        if (record) {
            console.log(`🔍 Found record with ${fieldName}=${fieldValue} in ${fileName}`);
        } else {
            console.log(`❌ No record found with ${fieldName}=${fieldValue} in ${fileName}`);
        }

        return record;
    }

    /**
     * Filter records by criteria
     * @param fileName - Data file name
     * @param criteria - Filter criteria object
     * @param fileType - File type ('json' or 'csv')
     */
    public filterRecords(fileName: string, criteria: Partial<TestDataRecord>, fileType: 'json' | 'csv' = 'json'): TestDataRecord[] {
        const data = fileType === 'json' ? this.loadJsonData(fileName) : this.loadCsvData(fileName);

        const filteredData = data.filter(record => {
            return Object.keys(criteria).every(key => record[key] === criteria[key]);
        });

        console.log(`🔍 Filtered ${filteredData.length} records from ${data.length} total records`);
        return filteredData;
    }

    /**
     * Get random record from data file
     * @param fileName - Data file name
     * @param fileType - File type ('json' or 'csv')
     */
    public getRandomRecord(fileName: string, fileType: 'json' | 'csv' = 'json'): TestDataRecord {
        const data = fileType === 'json' ? this.loadJsonData(fileName) : this.loadCsvData(fileName);
        const randomIndex = Math.floor(Math.random() * data.length);

        console.log(`🎲 Selected random record at index ${randomIndex} from ${fileName}`);
        return data[randomIndex];
    }

    /**
     * Get multiple random records
     * @param fileName - Data file name
     * @param count - Number of records to return
     * @param fileType - File type ('json' or 'csv')
     * @param allowDuplicates - Whether to allow duplicate records
     */
    public getRandomRecords(fileName: string, count: number, fileType: 'json' | 'csv' = 'json', allowDuplicates: boolean = false): TestDataRecord[] {
        const data = fileType === 'json' ? this.loadJsonData(fileName) : this.loadCsvData(fileName);

        if (count > data.length && !allowDuplicates) {
            throw new Error(`Cannot get ${count} unique records from ${data.length} total records`);
        }

        const result: TestDataRecord[] = [];
        const usedIndices: Set<number> = new Set();

        while (result.length < count) {
            const randomIndex = Math.floor(Math.random() * data.length);

            if (allowDuplicates || !usedIndices.has(randomIndex)) {
                result.push(data[randomIndex]);
                usedIndices.add(randomIndex);
            }
        }

        console.log(`🎲 Selected ${count} random records from ${fileName}`);
        return result;
    }

    /**
     * Validate required fields in data
     * @param fileName - Data file name
     * @param requiredFields - Array of required field names
     * @param fileType - File type ('json' or 'csv')
     */
    public validateDataStructure(fileName: string, requiredFields: string[], fileType: 'json' | 'csv' = 'json'): boolean {
        const data = fileType === 'json' ? this.loadJsonData(fileName) : this.loadCsvData(fileName);

        if (data.length === 0) {
            console.warn(`⚠️ No data found in ${fileName}`);
            return false;
        }

        const missingFields: string[] = [];
        const firstRecord = data[0];

        requiredFields.forEach(field => {
            if (!(field in firstRecord)) {
                missingFields.push(field);
            }
        });

        if (missingFields.length > 0) {
            console.error(`❌ Missing required fields in ${fileName}: ${missingFields.join(', ')}`);
            return false;
        }

        console.log(`✅ Data structure validation passed for ${fileName}`);
        return true;
    }

    /**
     * Clear cached data
     * @param fileName - Specific file to clear from cache (optional)
     */
    public clearCache(fileName?: string): void {
        if (fileName) {
            const jsonFileName = this.normalizeFileName(fileName, '.json');
            const csvFileName = this.normalizeFileName(fileName, '.csv');
            this.dataCache.delete(jsonFileName);
            this.dataCache.delete(csvFileName);
            console.log(`🗑️ Cleared cache for ${fileName}`);
        } else {
            this.dataCache.clear();
            console.log('🗑️ Cleared all cached data');
        }
    }

    /**
     * Get data directory path
     */
    public getDataDirectory(): string {
        return this.config.dataDirectory!;
    }

    /**
     * Set data directory
     * @param directory - New data directory path
     */
    public setDataDirectory(directory: string): void {
        this.config.dataDirectory = directory;
        this.clearCache(); // Clear cache when directory changes
        console.log(`📁 Data directory set to: ${directory}`);
    }

    /**
     * Check if data file exists
     * @param fileName - Data file name
     * @param fileType - File type ('json' or 'csv')
     */
    public dataFileExists(fileName: string, fileType: 'json' | 'csv' = 'json'): boolean {
        const normalizedFileName = this.normalizeFileName(fileName, fileType === 'json' ? '.json' : '.csv');
        const filePath = path.join(this.config.dataDirectory!, normalizedFileName);
        return fs.existsSync(filePath);
    }

    /**
     * Get all available data files
     * @param fileType - Filter by file type (optional)
     */
    public getAvailableDataFiles(fileType?: 'json' | 'csv'): string[] {
        if (!fs.existsSync(this.config.dataDirectory!)) {
            console.warn(`⚠️ Data directory does not exist: ${this.config.dataDirectory}`);
            return [];
        }

        const files = fs.readdirSync(this.config.dataDirectory!);
        let filteredFiles = files;

        if (fileType) {
            const extension = fileType === 'json' ? '.json' : '.csv';
            filteredFiles = files.filter(file => file.endsWith(extension));
        }

        console.log(`📁 Found ${filteredFiles.length} data files in ${this.config.dataDirectory}`);
        return filteredFiles;
    }

    /**
     * Normalize file name by adding extension if missing
     */
    private normalizeFileName(fileName: string, extension: string): string {
        return fileName.endsWith(extension) ? fileName : fileName + extension;
    }

    /**
     * Convert data to different format for compatibility
     * @param data - Data to convert
     * @param targetFormat - Target format ('flat' for simple key-value pairs)
     */
    public convertDataFormat(data: TestDataRecord[], targetFormat: 'flat'): any[] {
        switch (targetFormat) {
            case 'flat':
                return data.map(record => {
                    const flatRecord: any = {};
                    Object.keys(record).forEach(key => {
                        // Convert nested objects to dot notation
                        if (typeof record[key] === 'object' && record[key] !== null) {
                            Object.keys(record[key]).forEach(nestedKey => {
                                flatRecord[`${key}.${nestedKey}`] = record[key][nestedKey];
                            });
                        } else {
                            flatRecord[key] = record[key];
                        }
                    });
                    return flatRecord;
                });
            default:
                return data;
        }
    }
}

// Export singleton instance
export const testDataHelper = TestDataHelper.getInstance();
