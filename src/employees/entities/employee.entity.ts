import { ObjectId } from 'mongodb';

export interface Employee {
  _id: ObjectId;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  hireDate: string;
  annualCtc: number;
}
