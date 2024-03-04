/*
 * Twilio - Api
 *
 * This is the public Twilio REST API.
 *
 * The version of the OpenAPI document: 1.55.0
 * Contact: support@twilio.com
 * Generated by: https://openapi-generator.tech
 */


/// 
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub enum MessageEnumRiskCheck {
    #[serde(rename = "enable")]
    Enable,
    #[serde(rename = "disable")]
    Disable,

}

impl ToString for MessageEnumRiskCheck {
    fn to_string(&self) -> String {
        match self {
            Self::Enable => String::from("enable"),
            Self::Disable => String::from("disable"),
        }
    }
}

impl Default for MessageEnumRiskCheck {
    fn default() -> MessageEnumRiskCheck {
        Self::Enable
    }
}



