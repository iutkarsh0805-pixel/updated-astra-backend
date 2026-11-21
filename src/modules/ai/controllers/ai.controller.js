// AI Controllers
import {
  generateSummary,
  generateRecommendations,
  analyzeSentiment,
  generateInsights,
  detectLanguage
} from '../services/ai.service.js';

export const generateSummaryController = async (req, res, next) => {
  try {
    const summary = await generateSummary(req.body);
    res.json({ success: true, data: { summary } });
  } catch (error) {
    next(error);
  }
};

export const generateRecommendationsController = async (req, res, next) => {
  try {
    const recommendations = await generateRecommendations(req.body);
    res.json({ success: true, data: { recommendations } });
  } catch (error) {
    next(error);
  }
};

export const analyzeSentimentController = async (req, res, next) => {
  try {
    const result = await analyzeSentiment(req.body.text);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const generateInsightsController = async (req, res, next) => {
  try {
    const insights = await generateInsights(req.body);
    res.json({ success: true, data: { insights } });
  } catch (error) {
    next(error);
  }
};

export const detectLanguageController = async (req, res, next) => {
  try {
    const language = await detectLanguage(req.body.text);
    res.json({ success: true, data: { language } });
  } catch (error) {
    next(error);
  }
};