// AI Service Integration
// This module provides AI-powered features for the Astra astrology platform

import { logger } from '../../../lib/logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Configuration
const AI_CONFIG = {
  summaryGeneration: true,
  recommendationGeneration: true,
  languageDetection: true,
  sentimentAnalysis: true,
  insightsGeneration: true
};

// Gemini AI initialization
const geminiApiKey = process.env.GEMINI_API_KEY;
const gemini = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
const geminiModel = gemini
  ? gemini.getGenerativeModel({ model: 'gemini-2.0-flash' })
  : null;

/**
 * Generate summary from consultation data
 * @param {Object} consultationData - The consultation/transcript data
 * @returns {Promise<string>} - Generated summary
 */
export const generateSummary = async (consultationData) => {
  if (!AI_CONFIG.summaryGeneration) {
    return 'Summary not available';
  }

  try {
    // In production, integrate with actual AI service (Claude, OpenAI, etc.)
    // For now, use template-based generation

    const summary = `
Based on the consultation with ${consultationData.astrologerName || 'the astrologer'}:

Key Topics Discussed:
${(consultationData.topics || []).map(t => `• ${t}`).join('\n') || '• General consultation'}

Recommendations Provided:
${(consultationData.recommendations || []).map(r => `• ${r}`).join('\n') || '• Consultation completed successfully'}

Customer Birth Details:
${consultationData.birthDetails ? `
• Date: ${consultationData.birthDetails.date || 'Not provided'}
• Time: ${consultationData.birthDetails.time || 'Not provided'}
• Location: ${consultationData.birthDetails.location || 'Not provided'}
` : '• Not provided'}

Next Steps:
• Review the consultation notes regularly
• Track any remedies or practices mentioned
• Schedule follow-up consultation in 30 days
• Keep a journal of astrological insights`;

    return summary.trim();
  } catch (error) {
    logger.error('Error generating summary:', error);
    return 'Summary generation failed';
  }
};

/**
 * Generate personalized recommendations
 * @param {Object} bookingData - Booking and consultation data
 * @returns {Promise<Array<string>>} - Array of recommendations
 */
export const generateRecommendations = async (bookingData) => {
  if (!AI_CONFIG.recommendationGeneration) return [];

  try {
    if (!geminiModel) throw new Error('GEMINI_API_KEY is not configured');
    const prompt = `Return a JSON array of 3-6 practical astrology consultation recommendations. Base it only on this data: ${JSON.stringify(bookingData)}. Respond only with valid JSON.`;
    const text = await askGemini(prompt);
    return JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/, '').trim());
  } catch (error) {
    logger.error('Error generating recommendations:', error);
    return [];
  }
};

/**
 * Analyze sentiment from transcript
 * @param {string} transcriptContent - The transcript content to analyze
 * @returns {Promise<Object>} - Sentiment analysis results
 */
export const analyzeSentiment = async (transcriptContent) => {
  if (!AI_CONFIG.sentimentAnalysis) return { sentiment: 'neutral', confidence: 0 };

  try {
    if (!geminiModel) throw new Error('GEMINI_API_KEY is not configured');
    const prompt = `Analyze sentiment for this transcript. Return only JSON with keys sentiment (positive|neutral|negative), confidence (0-1), positiveCount, and negativeCount. Transcript: ${transcriptContent}`;
    const text = await askGemini(prompt);
    return JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/, '').trim());
  } catch (error) {
    logger.error('Error analyzing sentiment:', error);
    return { sentiment: 'neutral', confidence: 0, positiveCount: 0, negativeCount: 0 };
  }
};

/**
 * Generate insights from booking data
 * @param {Object} bookingData - Aggregated booking and performance data
 * @returns {Promise<string>} - Generated insights
 */
export const generateInsights = async (bookingData) => {
  if (!AI_CONFIG.insightsGeneration) {
    return 'No insights available';
  }

  try {
    const insights = [];

    // Booking pattern insights
    if (bookingData.bookingAmount && bookingData.bookingAmount > 0) {
      insights.push(`Average booking value: ${bookingData.bookingAmount}`);
    }

    // Service insights
    if (bookingData.service) {
      insights.push(`Service type: ${bookingData.service}`);
    }

    // Astrologer performance
    if (bookingData.astrologerRating) {
      const rating = bookingData.astrologerRating.toFixed(1);
      insights.push(`Astrologer rating: ${rating}/5.0`);
    }

    // Recommendations based on patterns
    if (insights.length === 0) {
      return 'No significant insights available for this booking.';
    }

    return `Key insights: ${insights.join('. ')}`;
  } catch (error) {
    logger.error('Error generating insights:', error);
    return 'Insights generation failed';
  }
};

/**
 * Detect language from text
 * @param {string} text - Text to detect language for
 * @returns {Promise<string>} - Detected language code
 */
export const detectLanguage = async (text) => {
  if (!AI_CONFIG.languageDetection) return 'en';

  try {
    if (!geminiModel) throw new Error('GEMINI_API_KEY is not configured');
    const prompt = `Return only a two-letter ISO 639-1 language code for this text. Text: ${text}`;
    return (await askGemini(prompt)).toLowerCase().slice(0, 2);
  } catch (error) {
    logger.error('Error detecting language:', error);
    return 'en';
  }
};

/**
 * Translate text
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code
 * @returns {Promise<string>} - Translated text
 */
export const translateText = async (text, targetLang = 'en') => {
  try {
    if (!geminiModel) throw new Error('GEMINI_API_KEY is not configured');
    const prompt = `Translate the following text into ${targetLang}. Preserve meaning and formatting. Return only the translation:\n${text}`;
    return await askGemini(prompt);
  } catch (error) {
    logger.error('Error translating text:', error);
    return text;
  }
};

/**
 * Ask Gemini AI
 * @param {string} prompt - Prompt for Gemini AI
 * @returns {Promise<string>} - Gemini AI response
 */
const askGemini = async (prompt) => {
  if (!geminiModel) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const result = await geminiModel.generateContent(prompt);
  return result.response.text().trim();
};

export default {
  generateSummary,
  generateRecommendations,
  analyzeSentiment,
  generateInsights,
  detectLanguage,
  translateText,
  askGemini
};