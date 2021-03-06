import { Resolver, Mutation, Args, Query, Context } from '@nestjs/graphql'
import { getMongoRepository } from 'typeorm'
import { ApolloError, ForbiddenError, AuthenticationError } from 'apollo-server-core'
import { generateToken, verifyToken, tradeToken } from '../auth'
import {
	CreateUserInput,
	UpdateUserInput,
	LoginUserInput,
	Result,
	SearchInput,
	UserResult,
	LoginResponse,
	RefreshTokenResponse,
	Type,
	UserType
} from '../generator/graphql.schema'
import { comparePassword, hashPassword } from '../utils'
import { EmailResolver } from './email.resolver'
import { USER_SUBSCRIPTION } from '../environments'
import { sendMail } from '../shared'
import { User } from '../models'

@Resolver('User')
export class UserResolver {
	constructor(
		private readonly emailResolver: EmailResolver,
	) {}
	@Query()
	async hello() {
		return 'world'
	}
	@Query()
	async today(): Promise<Date> {
		return new Date()
	}
	@Query()
	async users(
	): Promise<User[]> {
		const users = await getMongoRepository(User).find({
			isActive: true, // 1000: 60000 / 1 minute
		})
		// console.log(users)
		return users
	}
	@Query()
	async user(@Args('_id') _id: string): Promise<User> {
		try {
			const user = await getMongoRepository(User).findOne({ _id })

			if (!user) {
				throw new ForbiddenError('User not found.')
			}

			return user
		} catch (error) {
			throw new ApolloError(error)
		}
	}
	@Mutation()
	async createUser(
		@Args('input') input: CreateUserInput,
		@Context('pubsub') pubsub: any,
		@Context('req') req: any
		): Promise<User> {
		try {
			const { email, password } = input

			let existedUser

			existedUser = await getMongoRepository(User).findOne({
				where: {
					'email': email
				}
			})

			if (existedUser) {
				throw new ForbiddenError('User already exists.')
			}

			// Is there a Google account with the same email?
			if (existedUser) {
				const updateUser = await getMongoRepository(User).save(
					new User({
						...input,
							email,
							password: await hashPassword(password)
					})
				)

				return updateUser
			}

			const createdUser = await getMongoRepository(User).save(
				new User({
					...input,
						isVerified: true,
						email,
						password: await hashPassword(password)
				})
			)
			const emailToken = await generateToken(createdUser, 'emailToken')
			const existedEmail = await this.emailResolver.createEmail({
				userId: createdUser._id,
				type: Type.VERIFY_EMAIL
			})
			console.log(emailToken, existedEmail)
			await sendMail(
				'verifyEmail',
				createdUser,
				req,
				emailToken,
				existedEmail._id
			)
			return createdUser
		} catch (error) {
			throw new ApolloError(error)
		}
	}

	@Mutation()
	async login(@Args('input') input: LoginUserInput): Promise<LoginResponse> {
		const { email, password } = input

		const user = await getMongoRepository(User).findOne({
			where: {
				'email': email
			}
		})

		if (user && (await comparePassword(password, user.password))) {
			return await tradeToken(user)
		}

		throw new AuthenticationError('Login failed.')
	}

	@Mutation()
	async updateUser(
		@Args('_id') _id: string,
		@Args('input') input: UpdateUserInput
	): Promise<boolean> {
		try {
			const { password } = input
			const user = await getMongoRepository(User).findOne({ _id })
			if (!user) {
				throw new ForbiddenError('User not found.')
			}
			const updateUser = await await getMongoRepository(User).save(
				new User({
					...user,
					...input,
					password: await hashPassword(password)
				})
			)

			return updateUser ? true : false
		} catch (error) {
			throw new ApolloError(error)
		}
	}
	@Mutation()
	async deleteUser(
		@Args('_id') _id: string
	): Promise<boolean> {
		try {
			const user = await getMongoRepository(User).findOne({ _id })
			if (!user) {
				throw new ForbiddenError('User not found')
			}
			const updateUser = await getMongoRepository(User).save(
				new User({
					...user,
					isActive: false
				})
			)
			return updateUser ? true : false
		} catch (error) {
			throw new ApolloError(error)
		}
	}
	@Mutation()
	async changePassword(
		@Args('_id') _id: string,
		@Args('currentPassword') currentPassword: string,
		@Args('password') password: string
	): Promise<boolean> {
		const user = await getMongoRepository(User).findOne({ _id })

		console.log(currentPassword , password)

		if (!user) {
			throw new ForbiddenError('User not found.')
		}

		if (!(await comparePassword(currentPassword, user.password))) {
			throw new ForbiddenError('Your current password is missing or incorrect.')
		}

		if (await comparePassword(password, user.password)) {
			throw new ForbiddenError(
				'Your new password must be different from your previous password.'
			)
		}

		const updateUser = await getMongoRepository(User).save(
			new User({
				...user,
					password: await hashPassword(password)
			})
		)

		return updateUser ? true : false
	}
}
