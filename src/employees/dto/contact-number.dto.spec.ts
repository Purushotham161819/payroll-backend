import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEmployeeDto } from './create-employee.dto';
import { UpdateEmployeeDto } from './update-employee.dto';

describe('Optional employee contact number', () => {
  it.each([
    undefined,
    '',
    '+91 (98765) 43210',
    '+1 212-555-0100 ext. 123',
    '(020) 1234 5678',
    '001-234-567-890',
  ])(
    'accepts international/local notation without assigning a country code: %p',
    async (contactNumber) => {
      for (const dto of [
        plainToInstance(CreateEmployeeDto, { contactNumber }),
        plainToInstance(UpdateEmployeeDto, { contactNumber }),
      ]) {
        expect(
          (await validate(dto)).filter(
            (error) => error.property === 'contactNumber',
          ),
        ).toHaveLength(0);
        expect(dto.contactNumber).toBe(contactNumber);
      }
    },
  );
  it.each([null, 12345, 'not a number', '+', '1'.repeat(41), '123\n456'])(
    'rejects invalid contact values: %p',
    async (contactNumber) => {
      expect(
        (
          await validate(plainToInstance(UpdateEmployeeDto, { contactNumber }))
        ).some((error) => error.property === 'contactNumber'),
      ).toBe(true);
    },
  );
});
