import { validate } from 'class-validator';
import { CreateUserDto, PasswordDto } from './users.dto';
import { LoginDto } from './auth.controller';

describe('Eight-character password minimum', () => {
  for (const Dto of [CreateUserDto, PasswordDto, LoginDto]) {
    it(`${Dto.name} accepts 8 characters and rejects 7 independently of the frontend`, async () => {
      const valid = Object.assign(new Dto(), {email:'test@example.test',role:'user',active:true,password:'12345678'});
      expect(await validate(valid)).toEqual([]);
      valid.password = '1234567';
      const errors = await validate(valid);
      expect(errors.find(e=>e.property==='password')?.constraints?.minLength).toBe('Password must be at least 8 characters long.');
    });
  }
});
