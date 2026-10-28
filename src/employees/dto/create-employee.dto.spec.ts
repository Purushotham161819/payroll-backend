import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEmployeeDto } from './create-employee.dto';

describe('Employee email validation (no database writes)', () => {
  it('normalizes whitespace and case before email validation', async () => {
    const dto = plainToInstance(CreateEmployeeDto, {
      email: '  Person@Example.com  ',
    });
    expect(dto.email).toBe('person@example.com');
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'email')).toBe(false);
  });

  it.each([undefined, null, '', '   ', 'invalid-email', 123])(
    'rejects invalid or missing email %p',
    async (email) => {
      const dto = plainToInstance(CreateEmployeeDto, { email });
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'email')).toBe(true);
    },
  );
});
