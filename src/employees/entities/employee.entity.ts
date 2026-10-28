import { ObjectId } from 'mongodb';
import type { PAY_FREQUENCIES } from '../pay-frequency';

export interface Employee {
  _id: ObjectId;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  hireDate: string;
  annualCtc: number;
  payFrequency?: (typeof PAY_FREQUENCIES)[number];
}
