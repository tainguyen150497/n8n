/* eslint-disable n8n-nodes-base/node-dirname-against-convention */
import { DynamicTool } from '@langchain/core/tools';
import FormData from 'form-data';
import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

import { getConnectionHintNoticeField } from '@utils/sharedFields';

const DEFAULT_DESCRIPTION =
	'Transcribes the audio file attached to the current message into text, so you can listen to and understand it. ' +
	'Call this whenever the user sends audio or voice and you need to know what was said. ' +
	'The input is optional: leave it empty, or pass the name of the binary field holding the audio.';

export class ToolWhisper implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Whisper Audio Transcription Tool',
		name: 'toolWhisper',
		icon: { light: 'file:openAi.svg', dark: 'file:openAi.dark.svg' },
		group: ['transform'],
		version: 1,
		description: 'Lets an AI Agent listen to audio by transcribing it with OpenAI Whisper',
		defaults: {
			name: 'Whisper',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools'],
				Tools: ['Other Tools'],
			},
			alias: ['speech', 'voice', 'audio', 'transcribe', 'speech to text', 'stt'],
			resources: {
				primaryDocumentation: [
					{
						url: 'https://platform.openai.com/docs/guides/speech-to-text',
					},
				],
			},
		},
		credentials: [
			{
				name: 'openAiApi',
				required: true,
			},
		],
		// eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node
		inputs: [],
		// eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong
		outputs: [NodeConnectionType.AiTool],
		outputNames: ['Tool'],
		properties: [
			getConnectionHintNoticeField([NodeConnectionType.AiAgent]),
			{
				displayName:
					'The audio must be a binary field on the item the Agent receives (e.g. a voice message from Telegram/WhatsApp, or a file from the Chat Trigger). Supported formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Input Data Field Name',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				placeholder: 'e.g. data',
				hint: 'The name of the input field containing the audio file. Leave empty to use the first audio file found.',
			},
			{
				displayName: 'Description',
				name: 'toolDescription',
				type: 'string',
				default: DEFAULT_DESCRIPTION,
				description: 'Explain to the LLM when and how to use this tool',
				typeOptions: {
					rows: 3,
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				placeholder: 'Add Option',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Model',
						name: 'model',
						type: 'options',
						default: 'whisper-1',
						description:
							'The transcription model. When using a self-hosted Whisper server (via the credential Base URL), any model name it accepts can be set with an expression.',
						options: [
							{ name: 'Whisper-1', value: 'whisper-1' },
							{ name: 'GPT-4o Transcribe', value: 'gpt-4o-transcribe' },
							{ name: 'GPT-4o Mini Transcribe', value: 'gpt-4o-mini-transcribe' },
						],
					},
					{
						displayName: 'Language of the Audio File',
						name: 'language',
						type: 'string',
						default: '',
						placeholder: 'e.g. vi',
						description:
							'The language of the input audio in <a href="https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes" target="_blank">ISO-639-1</a> format (e.g. "vi" for Vietnamese). Improves accuracy and latency. Leave empty to auto-detect.',
					},
					{
						displayName: 'Prompt',
						name: 'prompt',
						type: 'string',
						default: '',
						description:
							'Optional text to guide the transcription style or spell out names and terms that appear in the audio',
					},
					{
						displayName: 'Output Randomness (Temperature)',
						name: 'temperature',
						type: 'number',
						default: 0,
						typeOptions: {
							minValue: 0,
							maxValue: 1,
							numberPrecision: 1,
						},
					},
				],
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const defaultBinaryPropertyName = this.getNodeParameter(
			'binaryPropertyName',
			itemIndex,
			'',
		) as string;
		const toolDescription = this.getNodeParameter(
			'toolDescription',
			itemIndex,
			DEFAULT_DESCRIPTION,
		) as string;
		const options = this.getNodeParameter('options', itemIndex, {}) as {
			model?: string;
			language?: string;
			prompt?: string;
			temperature?: number;
		};

		const credentials = await this.getCredentials<{ url?: string }>('openAiApi');
		const baseUrl = (credentials.url || 'https://api.openai.com/v1').replace(/\/+$/, '');

		const findAudioProperty = (requested: string): string => {
			const binary = this.getInputData()[itemIndex]?.binary ?? {};
			if (requested && binary[requested]) return requested;

			const audioKey = Object.keys(binary).find(
				(key) =>
					binary[key].mimeType?.startsWith('audio/') ||
					binary[key].mimeType?.startsWith('video/'),
			);
			if (audioKey) return audioKey;

			throw new NodeOperationError(
				this.getNode(),
				requested
					? `No binary field "${requested}" and no audio file found on the input item`
					: 'No audio file found on the input item',
			);
		};

		const transcribe = async (query: string): Promise<string> => {
			const { index } = this.addInputData(NodeConnectionType.AiTool, [[{ json: { query } }]]);

			try {
				const propertyName = findAudioProperty(query.trim() || defaultBinaryPropertyName);
				const binaryData = this.helpers.assertBinaryData(itemIndex, propertyName);
				const dataBuffer = await this.helpers.getBinaryDataBuffer(itemIndex, propertyName);

				const formData = new FormData();
				formData.append('model', options.model || 'whisper-1');
				if (options.language) formData.append('language', options.language);
				if (options.prompt) formData.append('prompt', options.prompt);
				if (options.temperature) formData.append('temperature', options.temperature.toString());
				formData.append('file', dataBuffer, {
					filename: binaryData.fileName ?? `${propertyName}.${binaryData.fileExtension ?? 'mp3'}`,
					contentType: binaryData.mimeType,
				});

				const result = (await this.helpers.requestWithAuthentication.call(this, 'openAiApi', {
					method: 'POST',
					uri: `${baseUrl}/audio/transcriptions`,
					headers: { 'Content-Type': 'multipart/form-data' },
					formData,
					json: true,
				})) as IDataObject;

				const text = typeof result?.text === 'string' ? result.text : JSON.stringify(result);

				void this.addOutputData(NodeConnectionType.AiTool, index, [[{ json: { response: text } }]]);
				return text;
			} catch (error) {
				const executionError = new NodeOperationError(this.getNode(), error as Error);
				void this.addOutputData(NodeConnectionType.AiTool, index, executionError);
				return `There was an error: "${executionError.message}"`;
			}
		};

		return {
			response: new DynamicTool({
				name: 'transcribe_audio',
				description: toolDescription,
				func: transcribe,
			}),
		};
	}
}
